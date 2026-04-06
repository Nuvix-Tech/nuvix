import { Collection } from '@nuvix/db'
import { authCollections, commonCollections } from './common'

export const projectCollections: Record<
  string,
  Omit<Collection, 'documentSecurity' | 'enabled'>
> = {
  ...authCollections,
  ...commonCollections,
}
