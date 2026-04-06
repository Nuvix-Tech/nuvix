import { configuration } from '@nuvix/utils'
import { paths as rootpaths } from '@nuvix/utils/configuration'

export function getVendorPath(...paths: string[]) {
  if (!configuration.app.isProduction) {
    return rootpaths.fromRoot('node_modules', ...paths)
  }

  return rootpaths.fromRoot('vendor', ...paths)
}
