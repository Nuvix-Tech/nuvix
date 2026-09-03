import { type Device, Local, Storage } from '@nuvix/storage'

export type FileDevice = Pick<
  Device,
  'read' | 'write' | 'delete' | 'stat' | 'presign' | 'exists' | 'getPath'
>

export interface StorageDevices {
  get(name?: string): FileDevice
}

export interface StorageDeviceConfig {
  readonly root?: string
  readonly defaultDeviceName?: string
}

/**
 * Initializes the central storage device registry and returns a narrow StorageDevices resolver.
 */
export function createStorageDevices(config: StorageDeviceConfig = {}): StorageDevices {
  const root = config.root || process.env.NUVIX_STORAGE_ROOT || './.data/storage'
  const defaultDeviceName =
    config.defaultDeviceName || process.env.NUVIX_STORAGE_DEVICE || Storage.DEVICE_LOCAL

  if (!Storage.exists(Storage.DEVICE_LOCAL)) {
    const localDevice = new Local(root)
    Storage.setDevice(Storage.DEVICE_LOCAL, localDevice)
  }

  return {
    get(name?: string): FileDevice {
      const targetName = name || defaultDeviceName
      return Storage.getDevice(targetName)
    },
  }
}
