/*
 * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
 * Use of this source code is governed by a MIT license that can be
 * found in the LICENSE file.
 */
import { RNInstance, TurboModuleContext } from '@rnoh/react-native-openharmony/ts';
import { TcpSocketClient } from './TcpSocketClient'
import { TcpSocketServer } from './TcpSocketServer'
import { socket } from '@kit.NetworkKit';

export class TcpEventListener {
  private rnInstance?: RNInstance;

  constructor(ctx: TurboModuleContext) {
    this.rnInstance = ctx.rnInstance;
  }

  async onConnection(serverId: number, clientId: number, connection: socket.TCPSocketConnection) {
    let localAddress = await connection?.getLocalAddress() as socket.NetAddress;
    let remoteAddress = await connection?.getRemoteAddress() as socket.NetAddress;
    let localFamily = remoteAddress.family === 2 ? "IPv6" : "IPv4"
    this.sendEvent("connection", {
      "id": serverId,
      "info": {
        "id": clientId,
        "connection": {
          "localAddress": localAddress.address,
          "localPort": localAddress.port,
          "remoteAddress": remoteAddress.address,
          "remotePort": remoteAddress.port,
          "remoteFamily": localFamily
        }
      }
    });
  }

  async onSecureConnection(serverId: number, clientId: number, connection: socket.TLSSocketConnection) {
    let localAddress = await connection?.getLocalAddress() as socket.NetAddress;
    let remoteAddress = await connection?.getRemoteAddress() as socket.NetAddress;
    let remoteFamily = remoteAddress.family === 2 ? "IPv6" : "IPv4"
    this.sendEvent("secureConnection", {
      "id": serverId,
      "info": {
        "id": clientId,
        "connection": {
          "localAddress": localAddress.address,
          "localPort": localAddress.port,
          "remoteAddress": remoteAddress.address,
          "remotePort": remoteAddress.port,
          "remoteFamily": remoteFamily
        }
      }
    });
  }


  async onConnect(cid: number, client: TcpSocketClient) {
    let tcpSocket: socket.TCPSocket | socket.TLSSocket | socket.TCPSocketConnection | socket.TLSSocketConnection | undefined =
      client.getSocket();
    let localAddress = await tcpSocket?.getLocalAddress() as socket.NetAddress;
    let remoteAddress = await tcpSocket?.getRemoteAddress() as socket.NetAddress;
    let remoteFamily = remoteAddress.family === 2 ? "IPv6" : "IPv4"
    this.sendEvent("connect", {
      "id": cid,
      "connection": {
        "localAddress": localAddress.address,
        "localPort": localAddress.port,
        "remoteAddress": remoteAddress.address,
        "remotePort": remoteAddress.port,
        "remoteFamily": remoteFamily
      }
    });
  }

  async onListen(cId: number, tcpSocketServer: TcpSocketServer) {
    let serverSocket: socket.TCPSocketServer | socket.TLSSocketServer = tcpSocketServer.getServerSocket();
    let address: socket.NetAddress = await serverSocket.getLocalAddress();
    let localFamily = address.family === 2 ? "IPv6" : "IPv4"
    this.sendEvent("listening", {
      "id": cId,
      "connection": {
        "localAddress": address.address,
        "localPort": address.port,
        "localFamily": localFamily
      }
    });
  }

  onData(id: number,data:string) {
    this.sendEvent("data", {
      "id": id,
      "data": data
    });
  }

  onWritten(id: number, msgId: number, error: string) {
    this.sendEvent("written", {
      "id": id,
      "msgId": msgId,
      "error": error
    });
  }

  onClose(id: number, error: string) {
    this.sendEvent("close", {
      "id": id,
      "hadError": error ? true : false
    });
  }

  onError(id: number, error: string): void {
    this.sendEvent("error", {
      "id": id,
      "error": error
    });
  }

  private sendEvent(eventName: string, params: object): void {
    this.rnInstance?.emitDeviceEvent(eventName, params);
  }
}