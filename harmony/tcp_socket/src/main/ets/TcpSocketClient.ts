/*
 * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
 * Use of this source code is governed by a MIT license that can be
 * found in the LICENSE file.
 */
import { TcpSocket } from './TcpSocket'
import { TcpEventListener } from "./TcpEventListener"
import { socket } from '@kit.NetworkKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { util } from '@kit.ArkTS';
import Logger from './Logger'


interface SocketLinger {
  on: boolean;
  linger: number;
}

class SocketInfo {
  message: ArrayBuffer = new ArrayBuffer(1);
  remoteInfo: socket.SocketRemoteInfo = {} as socket.SocketRemoteInfo;
}

export class TcpSocketClient extends TcpSocket {
  private receiverListener?: TcpEventListener;
  private cid?: number;
  private connectTimeout: number = 6000;
  private tcpSocket?: socket.TCPSocket;
  private tlsSocket?: socket.TLSSocket;
  private tcpSocketConnection?: socket.TCPSocketConnection;
  private tlsSocketConnection?: socket.TLSSocketConnection;
  private paused: boolean = false;
  private tcpExtraOptions: socket.TCPExtraOptions = {
    keepAlive: false, //是否保持连接。默认为false
    OOBInline: false, //是否为OOB内联。默认为false
    TCPNoDelay: false, //TCPSocket连接是否无时延。默认为false
    socketLinger: {
      on: true,
      linger: 10000
    } as SocketLinger, //socket是否继续逗留。- on：是否逗留（true：逗留；false：不逗留）。- linger：逗留时长，单位毫秒（ms），取值范围为0~65535。当入参on设置为true时，才需要设置。
    receiveBufferSize: 4096, //接收缓冲区大小（单位：Byte），默认为0
    sendBufferSize: 4096, //发送缓冲区大小（单位：Byte），默认为0。
    reuseAddress: false, //是否重用地址。默认为false。
    socketTimeout: 30000 //套接字超时时间，单位毫秒（ms），默认为0。
  }
  tcpEvtListener: any;

  constructor(receiverListener: TcpEventListener, cid: number,
    tcpSocketConnection?: socket.TCPSocketConnection, tlsSocketConnection?: socket.TLSSocketConnection) {
    super(cid);
    this.receiverListener = receiverListener;
    this.cid = cid;
    this.tcpSocketConnection = tcpSocketConnection;
    this.tlsSocketConnection = tlsSocketConnection;
  }

  getSocket(): socket.TCPSocket | socket.TLSSocket | socket.TCPSocketConnection | socket.TLSSocketConnection | undefined {
    if (this.tcpSocketConnection) {
      return this.tcpSocketConnection;
    } else if (this.tlsSocketConnection) {
      return this.tlsSocketConnection;
    } else if (this.tlsSocket) {
      return this.tlsSocket;
    } else {
      return this.tcpSocket;
    }
  }

  private waitForData() {
    return new Promise<void>(resolve => {
      if (!this.paused) {
        resolve();
      } else {
        const interval = setInterval(() => {
          if (!this.paused) {
            clearInterval(interval);
            resolve();
          }
        }, 100);
      }
    });
  }

  private tcpSocketConnect(clientAddress: socket.NetAddress, serverAddress: socket.NetAddress,
    options: Object): Promise<void> {

    return new Promise((resolve, reject) => {
      this.tcpSocket = socket.constructTCPSocketInstance();
      this.tcpSocket.bind(clientAddress, (err: BusinessError) => {
        if (err) {
          Logger.info('bind fail:' + JSON.stringify(err));
          return;
        }
        Logger.info('TcpSocketClient bind success');
        let tcpConnect: socket.TCPConnectOptions = {} as socket.TCPConnectOptions;
        tcpConnect.address = serverAddress;
        tcpConnect.timeout = this.connectTimeout;
        this.tcpSocket?.connect(tcpConnect, (err: BusinessError) => {
          if (err) {
            Logger.info('TcpSocketClient connect fail');
            return;
          }
          this.tcpEvtListener?.onConnect(this.getId(), this);
          Logger.info('TcpSocketClient connect success');
          this.tcpExtraOptions.reuseAddress = options['reuseAddress'] ? true : false;
          this.tcpSocket?.setExtraOptions(this.tcpExtraOptions, (err: BusinessError) => {
            if (err) {
              Logger.info('TcpSocketClient tcpSocket setExtraOptions fail:' + err.message);
              return;
            }
            Logger.info('TcpSocketClient setExtraOptions success');
          });
          this.tcpSocket.on("close", () => {
            this.receiverListener?.onClose(this.getId(), "");
          });
          this.tcpSocket.on("message", (value: SocketInfo) => {
            let buffer = value.message;
            let base64Helper = new util.Base64Helper;
            let str = base64Helper.encodeToStringSync(new Uint8Array(buffer));
            this.waitForData();
            this.receiverListener?.onData(this.getId(), str);
          });

          this.tcpSocket.on('error', (err: BusinessError) => {
            if (err?.message) {
              this.receiverListener?.onError(this.getId(), err.message);
            }
          });
          resolve();
        })
      });
    });
  }

  private tlsSocketConnect(clientAddress: socket.NetAddress, serverAddress: socket.NetAddress,
    tlsOptions: Object): Promise<void> {

    return new Promise((resolve, reject) => {
      if (!this.tcpSocket) {
        this.receiverListener?.onError(this.cid, "tcpSocketClient is null");
        return;
      }
      let ca: string[] = tlsOptions["ca"];
      let key: string = tlsOptions["key"];
      let cert: string = tlsOptions["cert"];
      let androidKeyStore: string = tlsOptions["androidKeyStore"];
      let caAlias: string = tlsOptions["caAlias"];
      let keyAlias: string = tlsOptions["keyAlias"];
      let certAlias: string = tlsOptions["certAlias"];
      this.tlsSocket = socket.constructTLSSocketInstance(this.tcpSocket);
      let secureOptions: socket.TLSSecureOptions = {
        password: "",
        protocols: socket.Protocol.TLSv12,
        useRemoteCipherPrefer: true,
        signatureAlgorithms: "rsa_pss_rsae_sha256:ECDSA+SHA256",
        cipherSuite: "AES256-SHA256"
      }
      if (key) {
        secureOptions.key = key
      }
      if (cert) {
        secureOptions.cert = cert
      }
      if (ca) {
        secureOptions.ca = ca
      }
      let tlsConnectOptions: socket.TLSConnectOptions = {
        address: serverAddress,
        secureOptions: secureOptions,
        ALPNProtocols: ["spdy/1", "http/1.1"]
      }
      this.tlsSocket.connect(tlsConnectOptions, (err: BusinessError) => {
        if (err) {
          Logger.error("=====1TcpSocketClient connect callback error" + JSON.stringify(err));
        }
        this.tlsSocket.on("close", () => {
          Logger.info("TcpSocketClient on close success");
          this.receiverListener?.onClose(this.getId(), "");
        });
        this.tlsSocket.on("message", (value: SocketInfo) => {
          let buffer = value.message;
          let base64Helper = new util.Base64Helper;
          let str = base64Helper.encodeToStringSync(new Uint8Array(buffer));
          this.waitForData();
          this.receiverListener?.onData(this.getId(), str);
        });

        this.tlsSocket.on('error', (err: BusinessError) => {
          this.receiverListener?.onError(this.getId(), err.message);
        });
        resolve();
      });
    });
  }


  async connect(host: string, port: number, options: Object, tlsOptions: Object) {
    let localAddress: string = options['localAddress'] ? options['localAddress'] : "0.0.0.0";
    let localPort: number = options['localPort'] ? options['localPort'] : 0;
    if (this.tcpSocket || this.tlsSocket || this.tcpSocketConnection || this.tlsSocketConnection) {
      throw new Error("TcpSocketClient Already connected");
    }
    let clientAddress: socket.NetAddress = {
      address: localAddress,
      port: localPort,
      family: 1
    }
    let serverAddress: socket.NetAddress = {
      address: host,
      port: port,
      family: 1
    }
    await this.tcpSocketConnect(clientAddress, serverAddress, options);
    if (tlsOptions) {
      await this.tlsSocketConnect(clientAddress, serverAddress, tlsOptions);
    }
  }

  async startTLS(tlsOptions: Object) {
    if (this.tlsSocket) {
      Logger.info("TlsSocketClient Already connected");
      return;
    }
    let remoteAddress = await this.tcpSocket?.getRemoteAddress() as socket.NetAddress;
    this.tlsSocket = socket.constructTLSSocketInstance(this.tcpSocket);
    let ca: string[] = tlsOptions["ca"];
    let key: string = tlsOptions["key"];
    let cert: string = tlsOptions["cert"];

    let secureOptions: socket.TLSSecureOptions = {
      password: "",
      protocols: socket.Protocol.TLSv12,
      useRemoteCipherPrefer: true,
      signatureAlgorithms: "rsa_pss_rsae_sha256:ECDSA+SHA256",
      cipherSuite: "AES256-SHA256"
    }
    if (key) {
      secureOptions.key = key
    }
    if (cert) {
      secureOptions.cert = cert
    }
    if (ca) {
      secureOptions.ca = ca;
    }
    let serverAddress: socket.NetAddress = {
      address: remoteAddress.address,
      port: remoteAddress.port,
      family: remoteAddress.family
    }
    let tlsConnectOptions: socket.TLSConnectOptions = {
      address: serverAddress,
      secureOptions: secureOptions,
      ALPNProtocols: ["spdy/1", "http/1.1"]
    }
    this.tlsSocket.connect(tlsConnectOptions, (err: BusinessError) => {
      if (err) {
        Logger.error("TcpSocketClient startTLS connect callback error" + err.message);
      }
      this.tlsSocket.on("close", () => {
        this.receiverListener?.onClose(this.getId(), "");
      });
      this.tlsSocket.on("message", (value: SocketInfo) => {
        let buffer = value.message;
        let base64Helper = new util.Base64Helper;
        let str = base64Helper.encodeToStringSync(new Uint8Array(buffer));
        this.waitForData();
        this.receiverListener?.onData(this.getId(), str);
      });

      this.tlsSocket.on('error', (err: BusinessError) => {
        this.receiverListener?.onError(this.getId(), err.message);
      });
    });
  }

  write(msgId: number, data: ArrayBuffer) { //待实现多线程

    if (this.tcpSocketConnection) {
      let tcpSendOption: socket.TCPSendOptions = {
        data: data
      }
      this.tcpSocketConnection.send(tcpSendOption, (err: BusinessError) => {
        if (err) {
          this.receiverListener?.onWritten(this.getId(), msgId, err.message);
          this.receiverListener?.onError(this.getId(), err.message);
        }
        this.receiverListener?.onWritten(this.getId(), msgId, '');
      });

    } else if (this.tlsSocketConnection) {
      this.tlsSocketConnection.send(data, (err: BusinessError) => {
        if (err) {
          this.receiverListener?.onWritten(this.getId(), msgId, err.message);
          this.receiverListener?.onError(this.getId(), err.message);
        }
        this.receiverListener?.onWritten(this.getId(), msgId, '');
      });

    } else if (this.tlsSocket) {
      this.tlsSocket.send(data, (err: BusinessError) => {
        if (err) {
          this.receiverListener?.onWritten(this.getId(), msgId, err.message);
          this.receiverListener?.onError(this.getId(), err.message);
        }
        this.receiverListener?.onWritten(this.getId(), msgId, '');
      });
    } else {
      if (this.tcpSocket) {
        let tcpSendOptions: socket.TCPSendOptions = {
          data: data
        }
        this.tcpSocket.send(tcpSendOptions, (err: BusinessError) => {
          if (err) {
            this.receiverListener?.onWritten(this.getId(), msgId, err.message);
            this.receiverListener?.onError(this.getId(), err.message);
            return;
          }
          this.receiverListener?.onWritten(this.getId(), msgId, '');
        })
      } else {
        this.receiverListener?.onError(this.getId(), "Attempted to write to closed socket");
        return;
      }
    }
  }

  startListening() {
    if (this.tlsSocketConnection) {
      this.tlsSocketConnection.on("close", () => {
        this.receiverListener?.onClose(this.getId(), "");
      });
      this.tlsSocketConnection.on("message", (value: SocketInfo) => {
        let buffer = value.message;
        let base64Helper = new util.Base64Helper;
        let str = base64Helper.encodeToStringSync(new Uint8Array(buffer));
        this.waitForData();
        this.receiverListener?.onData(this.getId(), str);
      });

      this.tlsSocketConnection.on('error', (err: BusinessError) => {
        this.receiverListener?.onError(this.getId(), err.message);
      });

    }
    if (this.tcpSocketConnection) {
      this.tcpSocketConnection.on("close", () => {
        this.receiverListener?.onClose(this.getId(), "");
      });
      this.tcpSocketConnection.on("message", (value: SocketInfo) => {
        let buffer = value.message;
        let base64Helper = new util.Base64Helper;
        let str = base64Helper.encodeToStringSync(new Uint8Array(buffer));
        this.waitForData();
        this.receiverListener?.onData(this.getId(), str);
      });

      this.tcpSocketConnection.on('error', (err: BusinessError) => {
        this.receiverListener?.onError(this.getId(), err.message);
      });
    }
  }

  async getPeerCertificate(): Promise<string> {
    if (!this.tlsSocket) {
      this.receiverListener?.onError(this.getId(), "no peer certificate");
      return '';
    }
    let data: socket.X509CertRawData = await this.tlsSocket.getRemoteCertificate();
    let base64Helper = new util.Base64Helper;
    let result = base64Helper.encodeToStringSync(data.data);
    return result;
  }

  async getCertificate(): Promise<string> {
    if (!this.tlsSocket) {
      this.receiverListener?.onError(this.getId(), "no certificate");
      return '';
    }
    let data: socket.X509CertRawData = await this.tlsSocket.getCertificate();
    let base64Helper = new util.Base64Helper;
    let result = base64Helper.encodeToStringSync(data.data);
    return result;
  }

  destroy() {
    if (this.tlsSocketConnection) {
      this.tlsSocketConnection.close((err: BusinessError) => {
        if (err) {
          this.receiverListener?.onClose(this.getId(), err.message);
          return;
        }
      })
    } else if (this.tcpSocketConnection) {
      this.tcpSocketConnection.close((err: BusinessError) => {
        if (err) {
          this.receiverListener?.onClose(this.getId(), err.message);
          return;
        }
      })
    } else if (this.tlsSocket) {
      this.tlsSocket.close((err: BusinessError) => {
        if (err) {
          this.receiverListener?.onClose(this.getId(), err.message);
          return;
        }
      })
    } else if (this.tcpSocket) {
      this.tcpSocket.close((err: BusinessError) => {
        if (err) {
          this.receiverListener?.onClose(this.getId(), err.message);
          return;
        }
      })
    }
    this.receiverListener?.onClose(this.getId(), '');
  }

  setNoDelay(noDelay: boolean) {
    this.tcpExtraOptions.TCPNoDelay = noDelay
    if (this.tlsSocket) {
      this.tlsSocket?.setExtraOptions(this.tcpExtraOptions)
    } else {
      this.tcpSocket?.setExtraOptions(this.tcpExtraOptions)
    }
  }

  setKeepAlive(enable: boolean) {
    this.tcpExtraOptions.keepAlive = enable;
    if (this.tlsSocket) {
      this.tlsSocket?.setExtraOptions(this.tcpExtraOptions)
    } else {
      this.tcpSocket?.setExtraOptions(this.tcpExtraOptions)
    }
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }
}