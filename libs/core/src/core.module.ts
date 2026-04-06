import { BullModule } from '@nestjs/bullmq'
import {
  Global,
  Logger,
  Module,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { Database, StructureValidator } from '@nuvix/db'
import { configuration } from '@nuvix/utils'
import { filters, formats } from '@nuvix/utils/database'
import handlebars from 'handlebars'
import pg from 'pg'
import { parse as parseArray } from 'postgres-array'
import { CoreService } from './core.service.js'
import { StatsHelper } from './helpers/stats.helper.js'
import { QueueModule } from './queue.module.js'
import { RatelimitService } from './rate-limit.service.js'
import { Redis as IORedis } from 'ioredis'
import { SchedulesHelper } from './helpers/schedules.helper.js'

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      async useFactory() {
        const { secure, user, ...redisConfig } = configuration.redis
        const connection = new IORedis({
          connectionName: 'nuvix-core',
          ...redisConfig,
          username: user,
          tls: secure ? { rejectUnauthorized: false } : undefined,
          maxRetriesPerRequest: null,
        })

        connection.on('error', e => {
          if (
            'code' in e &&
            e.code === 'ECONNREFUSED' &&
            'syscall' in e &&
            e.syscall === 'connect'
          ) {
            Logger.error(`Redis connection failed: ${e.code}`)
            process.exit(1)
          } else Logger.error(e, 'BullModule')
        })

        return {
          connection,
          defaultJobOptions: {
            attempts: 2,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: true,
            removeOnFail: 100,
          },
          prefix: CoreService.isConsole() ? 'nuvix-console' : 'nuvix', // TODO: we have to include a instance key that should be unique per app instance
        }
      },
    }),
    QueueModule,
    EventEmitterModule.forRoot({
      global: true,
    }),
  ],
  providers: [CoreService, RatelimitService, StatsHelper, SchedulesHelper],
  exports: [QueueModule, CoreService, RatelimitService],
})
export class CoreModule implements OnModuleDestroy, OnModuleInit {
  constructor(private readonly coreService: CoreService) {}

  async onModuleInit() {
    await this.coreService.getCache().flush()
  }

  async onModuleDestroy() {
    await this.coreService.getCache().flush()
  }
}

export function configurePgTypeParsers() {
  const types = pg.types

  types.setTypeParser(types.builtins.INT8, x => {
    const asNumber = Number(x)
    return Number.isSafeInteger(asNumber) ? asNumber : x
  })

  types.setTypeParser(types.builtins.NUMERIC, Number.parseFloat)
  types.setTypeParser(types.builtins.FLOAT4, Number.parseFloat)
  types.setTypeParser(types.builtins.FLOAT8, Number.parseFloat)
  types.setTypeParser(types.builtins.BOOL, val => val === 't')

  types.setTypeParser(types.builtins.DATE, x => x)
  types.setTypeParser(types.builtins.TIMESTAMP, x => x)
  types.setTypeParser(types.builtins.TIMESTAMPTZ, x => x)
  types.setTypeParser(types.builtins.INTERVAL, x => x)

  types.setTypeParser(1115 as any, parseArray) // _timestamp[]
  types.setTypeParser(1182 as any, parseArray) // _date[]
  types.setTypeParser(1185 as any, parseArray) // _timestamptz[]
  types.setTypeParser(600 as any, x => x) // point
  types.setTypeParser(1017 as any, x => x) // _point
}

export function configureDbFiltersAndFormats() {
  Object.entries(filters).forEach(([key, filter]) => {
    Database.addFilter(key, filter)
  })

  Object.entries(formats).forEach(([key, format]) => {
    StructureValidator.addFormat(key, format)
  })
}

export function configureHandlebarsHelpers() {
  handlebars.registerHelper('b', function (this: any, options: any) {
    return new handlebars.SafeString(`<b>${options.fn(this)}</b>`)
  })

  handlebars.registerHelper('i', function (this: any, options: any) {
    return new handlebars.SafeString(`<i>${options.fn(this)}</i>`)
  })
}
