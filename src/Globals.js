import { DeviceEventEmitter } from 'react-native';


let instanceNumber = 0;

function getNextId() {
    return instanceNumber++;
}

const nativeEventEmitter = DeviceEventEmitter;

export { nativeEventEmitter, getNextId };
