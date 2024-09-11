import type { TurboModule } from 'react-native/Libraries/TurboModule/RCTExport';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {

    listen(cId: number, options: Object): void;

    close(cid: number): void;

    destroy(cid: number): void;

    end(cid: number): void;

    pause(cid: number): void;

    resume(cid: number): void;

    connect(cId: number, host: string, port: number, options: Object): void;

    startTLS(cId: number, tlsOptions: Object): void;

    write(cId: number, base64String: string, msgId: number): void;

    setNoDelay(cId: number, noDelay: boolean): void;

    setKeepAlive(cId: number, enable: boolean, initialDelay: number): void;

    getPeerCertificate(cId: number): Promise<string>;

    getCertificate(cId: number): Promise<string>;
}


export default TurboModuleRegistry.get<Spec>('TcpSocketModule') as Spec | null;