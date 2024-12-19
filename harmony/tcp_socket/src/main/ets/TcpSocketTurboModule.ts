/*
 * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
 * Use of this source code is governed by a MIT license that can be
 * found in the LICENSE file.
 */
import { TurboModule, RNOHError, TurboModuleContext } from '@rnoh/react-native-openharmony/ts';
import { TM } from "@rnoh/react-native-openharmony/generated/ts"
import { TcpEventListener } from "./TcpEventListener"
import { connection } from '@kit.NetworkKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { TcpSocket } from './TcpSocket'
import Logger from './Logger'
import { TcpSocketClient } from './TcpSocketClient'
import { TcpSocketServer } from './TcpSocketServer'
import { util } from '@kit.ArkTS';
import { Context } from '@kit.AbilityKit';

export class TcpSocketTurboModule extends TurboModule implements TM.TcpSocketModule.Spec {
  private socketMap: Map<number, TcpSocket> = new Map<number, TcpSocket>();
  private pendingTLS: Map<number, Object> = new Map<number, Object>();
  private mNetworkMap: Map<string, connection.ConnectionProperties> =
    new Map<string, connection.ConnectionProperties>();
  private tcpEvtListener?: TcpEventListener;
  private currentNetwork?: connection.ConnectionProperties;
  private context: Context;

  constructor(ctx: TurboModuleContext) {
    super(ctx)
    this.tcpEvtListener = new TcpEventListener(ctx);
    this.context = ctx.uiAbilityContext
  }

  private getTcpClient(cid: number): TcpSocketClient | undefined {
    let socket: TcpSocket | undefined = this.socketMap.get(cid);
    if (socket && (socket instanceof TcpSocketClient)) {
      return socket as TcpSocketClient;
    }
    return undefined;
  }

  private getTcpServer(cid: number): TcpSocketServer | undefined {
    let socket: TcpSocket | undefined = this.socketMap.get(cid);
    if (socket && (socket instanceof TcpSocketServer)) {
      return socket as TcpSocketServer;
    }
    return undefined;
  }

  private async requestNetwork(transportType: number, iotDeviceHost: string): Promise<void> {
    if (!iotDeviceHost || "localhost" === iotDeviceHost) {
      this.getDefaultNetInfo();
    } else {
      let netHandles = connection.getAllNetsSync();
      for (const netHandle of netHandles) {
        let conpro = connection.getNetCapabilitiesSync(netHandle);
        if (conpro.bearerTypes.includes(transportType)) {
          await connection.setAppNet(netHandle, (error: BusinessError, data: void) => {
            if (error) {
              Logger.error(`setAppNet error. Code:${error.code}, message:${error.message}`);
              return;
            }
            Logger.info("setAppNet Succeeded");
            this.currentNetwork = connection.getConnectionPropertiesSync(netHandle);
          });
        }
      }
    }
  }

  private getDefaultNetInfo() {
    if (!connection.hasDefaultNetSync()) {
      Logger.info("has not default net")
      return;
    }
    let netHandle: connection.NetHandle = connection.getDefaultNetSync();
    this.currentNetwork = connection.getConnectionPropertiesSync(netHandle);
  }

  private async selectNetwork(ipAddress: string, iface: string, iotDeviceHost: string): Promise<void> {
    if (!iface) {
      return;
    }
    if (ipAddress) {
      let cachedNetwork = this.mNetworkMap.get(iface + ipAddress);
      if (cachedNetwork) {
        this.currentNetwork = cachedNetwork;
      }
    }
    switch (iface) {
      case 'wifi':
        await this.requestNetwork(connection.NetBearType.BEARER_WIFI, iotDeviceHost);
        break;
      case 'cellular':
        await this.requestNetwork(connection.NetBearType.BEARER_CELLULAR, iotDeviceHost);
        break;
      case 'ethernet':
        await this.requestNetwork(connection.NetBearType.BEARER_ETHERNET, iotDeviceHost);
        break;
    }
    if (!this.currentNetwork) {
      throw new Error("Interface " + iface + " unreachable");
    } else {
      this.mNetworkMap.set(iface + ipAddress, this.currentNetwork);
    }
  }

  async connect(cId: number, host: string, port: number, options: Object): Promise<void> {
    if (this.socketMap.get(cId)) {
      this.tcpEvtListener?.onError(cId, "connect() called twice with the same id.");
      return;
    }
    try {
      let localAddress: string = options['localAddress'];
      let iface: string = options['interface'];
      let iotDeviceHost: string = options['host'];
      this.selectNetwork(localAddress, iface, iotDeviceHost);
      let client: TcpSocketClient = new TcpSocketClient(this.tcpEvtListener, cId);
      this.socketMap.set(cId, client);
      let tlsOptions = this.pendingTLS.get(cId);
      await client.connect(host, port, options, tlsOptions);
      this.tcpEvtListener?.onConnect(cId, client);
    } catch (err) {
      this.tcpEvtListener?.onError(cId, err?.message);
    }
  }

  startTLS(cId: number, tlsOptions: Object): void {
    let socketClient: TcpSocketClient = this.socketMap.get(cId) as TcpSocketClient;
    if (!socketClient) {
      this.pendingTLS.set(cId, tlsOptions);
    } else {
      try {
        socketClient.startTLS(tlsOptions);
      } catch (e) {
        this.tcpEvtListener?.onError(cId, JSON.stringify(e));
      }
    }
  }

  listen(cId: number, options: Object): void {
    let tcpSocketServer = new TcpSocketServer(this.socketMap, this.tcpEvtListener, cId, options);
    this.socketMap.set(cId, tcpSocketServer);
    this.tcpEvtListener.onListen(cId, tcpSocketServer);
  }

  close(cid: number): void {
    let socketServer: TcpSocketServer = this.getTcpServer(cid);
    socketServer?.close();
    let socketClient: TcpSocketClient = this.getTcpClient(cid);
    socketClient?.destroy();
    this.socketMap.delete(cid);
  }

  destroy(cid: number): void {
    this.end(cid);
  }

  end(cid: number): void {
    let socketClient = this.getTcpClient(cid);
    socketClient?.destroy();
    this.socketMap.delete(cid);
  }

  pause(cid: number): void {
    let socketClient = this.getTcpClient(cid);
    socketClient?.pause();
  }

  resume(cid: number): void {
    let socketClient = this.getTcpClient(cid);
    socketClient?.resume();
  }

  write(cId: number, base64String: string, msgId: number): void {
    let socketClient = this.getTcpClient(cId);
    let base64Helper = new util.Base64Helper;
    let uint8Array = base64Helper.decodeSync(base64String)
    let buffer = uint8Array.buffer as ArrayBuffer;
    socketClient?.write(msgId, buffer);
  }

  setNoDelay(cId: number, noDelay: boolean): void {
    try {
      let socketClient = this.getTcpClient(cId);
      socketClient?.setNoDelay(noDelay);
    } catch (e) {
      this.tcpEvtListener?.onError(cId, JSON.stringify(e));
    }
  }

  setKeepAlive(cId: number, enable: boolean, initialDelay: number): void {
    try {
      let socketClient: TcpSocketClient = this.getTcpClient(cId);
      socketClient?.setKeepAlive(enable);
    } catch (e) {
      this.tcpEvtListener?.onError(cId, JSON.stringify(e));
    }
  }

  getPeerCertificate(cId: number): Promise<string> {
    try {
      let socketClient = this.getTcpClient(cId);
      return socketClient?.getPeerCertificate();
    } catch (e) {
      this.tcpEvtListener?.onError(cId, JSON.stringify(e));
      return new Promise<string>(() => {
        return ""
      });
    }
  }

  getCertificate(cId: number): Promise<string> {
    try {
      let socketClient = this.getTcpClient(cId);
      return socketClient?.getCertificate();
    } catch (e) {
      this.tcpEvtListener?.onError(cId, JSON.stringify(e));
      return new Promise<string>(() => {
        return ""
      });
    }
  }
}

