import { demoReplay } from './demo-replay.ts';
import { miraHosted } from './mira-hosted.ts';
import type { ExtractModel } from './model.ts';
import { sentenceSplit } from './sentence-split.ts';

export const MODELS: ExtractModel[] = [demoReplay, sentenceSplit, miraHosted];
