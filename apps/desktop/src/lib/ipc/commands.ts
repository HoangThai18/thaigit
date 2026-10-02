import { Commands } from '@thaigit/contracts';

export { Commands, Events } from '@thaigit/contracts';

export type CommandName = (typeof Commands)[keyof typeof Commands];
