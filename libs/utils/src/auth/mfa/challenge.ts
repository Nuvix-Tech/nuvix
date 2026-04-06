import type { ChallengesDoc, UsersDoc } from '../../../types'

export abstract class Challenge {
  public static async verify(_user: UsersDoc, _otp: string): Promise<boolean> {
    return false
  }
  public static async challenge(
    _challenge: ChallengesDoc,
    _user: UsersDoc,
    _otp: string,
  ): Promise<boolean> {
    return false
  }
}
