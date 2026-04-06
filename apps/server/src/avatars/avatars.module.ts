import { Module, OnModuleInit } from '@nestjs/common'
import { AvatarsController } from './avatars.controller'
import { AvatarsService } from './avatars.service'
import { initWasm } from '@resvg/resvg-wasm'
import { getVendorPath } from '../core'
import { pathToFileURL } from 'node:url'

@Module({
  controllers: [AvatarsController],
  providers: [AvatarsService],
})
export class AvatarsModule implements OnModuleInit {
  async onModuleInit() {
    const path = getVendorPath('@resvg/resvg-wasm/index_bg.wasm')

    initWasm(pathToFileURL(path))
  }
}
