export interface TeamModel {
  readonly collection: string
  readonly fields: {
    readonly name: string
    readonly total: string
    readonly prefs: string
  }
}

export const TEAM_MODEL = {
  collection: 'teams',
  fields: {
    name: 'name',
    total: 'total',
    prefs: 'prefs',
  },
} as const satisfies TeamModel
