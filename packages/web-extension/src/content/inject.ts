import { record } from 'rrweb';
import type { recordOptions } from 'rrweb/typings/types';
import type { eventWithTime } from '@rrweb/types';
import { MessageName, RecordStartedMessage } from '~/types';
import { isInCrossOriginIFrame } from '~/utils';

const OPTIONS = {
  // recordCanvas: true,
  // inlineImages: true,
  // inlineStylesheet: true,
  sampling: {
    // 不录制鼠标移动事件
    mousemove: false,
    // // 不录制鼠标交互事件
    // mouseInteraction: false,
    // // 设置滚动事件的触发频率
    scroll: 150,
    // // set the interval of media interaction event
    // media: 800,
    // 设置输入事件的录制时机
    input: 'last', // 连续输入时，只录制最终值
  },
};

/**
 * This script is injected into both main page and cross-origin IFrames through <script> tags.
 */

const events: eventWithTime[] = [];
let stopFn: (() => void) | null = null;

function startRecord(config: recordOptions<eventWithTime>) {
  events.length = 0;
  stopFn =
    // @ts-ignore
    record({
      emit: (event) => {
        // ! by lwz in case of too many events
        if (events.length > 100) {
          stopFn();
        }

        events.push(event);
        postMessage({
          message: MessageName.EmitEvent,
          event,
        });
      },
      // @ts-ignore
      ...OPTIONS,
      ...config,
    }) || null;
  postMessage({
    message: MessageName.RecordStarted,
    startTimestamp: Date.now(),
  } as RecordStartedMessage);
}

const messageHandler = (
  event: MessageEvent<{
    message: MessageName;
    config?: recordOptions<eventWithTime>;
  }>,
) => {
  if (event.source !== window) return;
  const data = event.data;
  const eventHandler = {
    [MessageName.StartRecord]: () => {
      startRecord(data.config || {});
    },
    [MessageName.StopRecord]: () => {
      if (stopFn) {
        try {
          stopFn();
        } catch (e) {
          //
        }
      }
      postMessage({
        message: MessageName.RecordStopped,
        events,
        endTimestamp: Date.now(),
      });
      window.removeEventListener('message', messageHandler);
    },
  } as Record<MessageName, () => void>;
  if (eventHandler[data.message]) eventHandler[data.message]();
};

/**
 * Only post message in the main page.
 */
function postMessage(message: unknown) {
  if (!isInCrossOriginIFrame()) window.postMessage(message, location.origin);
}

window.addEventListener('message', messageHandler);

window.postMessage(
  {
    message: MessageName.RecordScriptReady,
  },
  location.origin,
);
