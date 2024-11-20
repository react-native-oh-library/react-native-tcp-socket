import { socket } from '@kit.NetworkKit';

import { TcpSocket } from './TcpSocket'
import { TcpEventListener } from "./TcpEventListener"
import { BusinessError } from '@kit.BasicServicesKit';
import Logger from './Logger'
import { TcpSocketClient } from './TcpSocketClient';

interface SocketLinger {
  on: boolean;
  linger: number;
}

export class TcpSocketServer extends TcpSocket {
  private receiverListener?: TcpEventListener;
  private cid?: number;
  private tcpSocketMap?: Map<number, TcpSocket>;
  private options?: object;
  private tcpSocketServer?: socket.TCPSocketServer;
  private tlsSocketServer?: socket.TLSSocketServer;
  private socketServerId?: number;

  private ipAddress: socket.NetAddress = {
    "address": '127.0.0.1',
    "port": 9999,
    "family": 1
  } as socket.NetAddress;

  private tcpExtraOptions: socket.TCPExtraOptions = {
    keepAlive: true,
    OOBInline: true,
    TCPNoDelay: true,
    socketLinger: { on: true, linger: 10 } as SocketLinger,
    receiveBufferSize: 1000,
    sendBufferSize: 1000,
    reuseAddress: true,
    socketTimeout: 3000
  }


  private createTlsSocketServer(tlsOption: Object) {
    this.tlsSocketServer = socket.constructTLSSocketServerInstance();
    let ca: string[] = tlsOption["ca"];
    let key: string = tlsOption["key"];
    let cert: string = tlsOption["cert"];

    let tlsSecureOptions: socket.TLSSecureOptions = {
      password: '',
      useRemoteCipherPrefer: true,
      signatureAlgorithms: "rsa_pss_rsae_sha256:ECDSA+SHA256",
      cipherSuite: "AES256-SHA256"
    }
     if (key) {
      tlsSecureOptions.key = key
     }
    if (cert) {
      tlsSecureOptions.cert = cert
     }
     if (ca) {
      tlsSecureOptions.ca = ca
    }
    let tlsConnectOptions: socket.TLSConnectOptions = {
      address: this.ipAddress,
      secureOptions: tlsSecureOptions,
      ALPNProtocols: ["spdy/1", "http/1.1"]
    }
    this.tlsSocketServer.listen(tlsConnectOptions, (err: BusinessError) => {
      if (err) {
        Logger.info("listen callback error" + err.message);
        return;
      }
      Logger.info("tlsSocketServer listen success");
      this.tlsSocketServer.on('connect', (client: socket.TLSSocketConnection) => {
        let clientId = this.getClientId();
        let socketClient = new TcpSocketClient(this.receiverListener, clientId, undefined, client);
        this.tcpSocketMap?.set(clientId, socketClient);
        this.receiverListener?.onSecureConnection(this.getId(), clientId, client);
        socketClient.startListening();
      });
      this.tlsSocketServer.on('error', (err: BusinessError) => {
        this.receiverListener?.onError(this.getId(), err.message);
      });
      this.tlsSocketServer.setExtraOptions(this.tcpExtraOptions);
    });

  }

  private createTcpSocketServer() {
    this.tcpSocketServer = socket.constructTCPSocketServerInstance();
    this.tcpSocketServer.listen(this.ipAddress, (err: BusinessError) => {
      if (err) {
        Logger.info("listen fail");
        return;
      }
      this.tcpSocketServer.on("connect", (client: socket.TCPSocketConnection) => {
        let clientId = this.getClientId();
        let socketClient = new TcpSocketClient(this.receiverListener, clientId, client);
        this.tcpSocketMap?.set(clientId, socketClient);
        this.receiverListener?.onConnection(this.getId(), clientId, client);
        socketClient.startListening();
      });
      this.tcpSocketServer.on('error', (err: BusinessError) => {
        this.receiverListener?.onError(this.getId(), err.message);
      });
      this.tcpSocketServer.setExtraOptions(this.tcpExtraOptions);
    });
  }


  constructor(tcpSocketMap: Map<number, TcpSocket>, receiverListener: TcpEventListener, cId: number, options: Object) {
    super(cId);
    this.receiverListener = receiverListener;
    this.cid = cId;
    this.tcpSocketMap = tcpSocketMap;
    this.options = options;
    this.socketServerId = (this.getId() + 1) * 1000;
    let port = options["port"] as number;
    let host = options["host"] as string;
    let tlsOption = options["tls"] as object;
    this.tcpExtraOptions.reuseAddress = options["reuseAddress"] as boolean;
    this.ipAddress.address = host;
    this.ipAddress.port = port;
    if (tlsOption) {
      this.createTlsSocketServer(tlsOption);
    } else {
      this.createTcpSocketServer();
    }
  }

  private getClientId(): number {
    return this.socketServerId++;
  }

  getServerSocket(): socket.TCPSocketServer | socket.TLSSocketServer {
    if (this.tlsSocketServer) {
      return this.tlsSocketServer;
    }
    return this.tcpSocketServer;
  }

  close() {
    this.tcpSocketServer?.off("connect");
    this.tlsSocketServer?.off("connect");
    this.receiverListener?.onClose(this.getId(), null);
  }
}