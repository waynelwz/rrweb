import Browser, { Storage } from 'webextension-polyfill';
import { nanoid } from 'nanoid';
import { EventType, IncrementalSource, type eventWithTime } from '@rrweb/types';
import {
  LocalData,
  LocalDataKey,
  RecorderStatus,
  ServiceName,
  Session,
  RecordStartedMessage,
  RecordStoppedMessage,
  MessageName,
  EmitEventMessage,
} from '~/types';
import Channel from '~/utils/channel';
import { isInCrossOriginIFrame } from '~/utils';
import html2canvas from 'html2canvas';

const channel = new Channel();

function isUserInteraction(event: eventWithTime): boolean {
  if (event.type !== EventType.IncrementalSnapshot) {
    return false;
  }
  return (
    event.data.source > IncrementalSource.Mutation &&
    event.data.source <= IncrementalSource.Input
  );
}

const capture = (event: MessageEvent) => {
  html2canvas(document.body, {
    x: window.scrollX,
    y: window.scrollY,
    width: window.innerWidth,
    height: window.innerHeight,
  }).then((canvas) => {
    var img = canvas.toDataURL('image/png');
    var imgEl = document.createElement('img');
    imgEl.src = img;
    document.body.appendChild(imgEl);
  });

  // window.postMessage(
  //   {
  //     message: MessageName.RecordScriptReady,
  //   },
  //   location.origin,
  // );
};

void (() => {
  window.addEventListener(
    'message',
    (
      event: MessageEvent<{
        message: MessageName;
      }>,
    ) => {
      // console.log('content message', event.data);
      if (event.source !== window) return;
      // * note by lwz disable auto record
      // if (event.data.message === MessageName.RecordScriptReady) doRecord();
    },
  );
  if (isInCrossOriginIFrame()) {
    void initCrossOriginIframe();
  } else if (window === window.top) {
    void initMainPage();
  }
  console.log('content init');
  // * note by lwz auto inject when page loaded
  startRecord();
})();

async function initMainPage() {
  let bufferedEvents: eventWithTime[] = [];
  let newEvents: eventWithTime[] = [];
  let startResponseCb: ((response: RecordStartedMessage) => void) | undefined =
    undefined;
  channel.provide(ServiceName.StartRecord, async () => {
    startRecord();
    return new Promise((resolve) => {
      startResponseCb = (response) => {
        resolve(response);
      };
    });
  });
  channel.provide(ServiceName.ResumeRecord, async (params) => {
    const { events, pausedTimestamp } = params as {
      events: eventWithTime[];
      pausedTimestamp: number;
    };
    bufferedEvents = events;
    startRecord();
    return new Promise((resolve) => {
      startResponseCb = (response) => {
        const pausedTime = response.startTimestamp - pausedTimestamp;
        // Decrease the time spent in the pause state and make them look like a continuous recording.
        bufferedEvents.forEach((event) => {
          event.timestamp += pausedTime;
        });
        resolve(response);
      };
    });
  });
  let stopResponseCb: ((response: RecordStoppedMessage) => void) | undefined =
    undefined;
  channel.provide(ServiceName.StopRecord, () => {
    window.postMessage({ message: MessageName.StopRecord });
    return new Promise((resolve) => {
      stopResponseCb = (response: RecordStoppedMessage) => {
        stopResponseCb = undefined;
        const newSession = generateSession();
        response.session = newSession;
        bufferedEvents = [];
        newEvents = [];
        resolve(response);
        // clear cache
        void Browser.storage.local.set({
          [LocalDataKey.bufferedEvents]: [],
        });
      };
    });
  });
  channel.provide(ServiceName.PauseRecord, () => {
    window.postMessage({ message: MessageName.StopRecord });
    return new Promise((resolve) => {
      stopResponseCb = (response: RecordStoppedMessage) => {
        stopResponseCb = undefined;
        bufferedEvents = [];
        newEvents = [];
        resolve(response);
        void Browser.storage.local.set({
          [LocalDataKey.bufferedEvents]: response.events,
        });
      };
    });
  });

  window.addEventListener(
    'message',
    (
      event: MessageEvent<
        | RecordStartedMessage
        | RecordStoppedMessage
        | EmitEventMessage
        | {
            message: MessageName;
          }
      >,
    ) => {
      if (event.data.event?.type !== 3)
        console.log('content message', event.data, event.data.event?.type);

      if (event.source !== window) return;
      else if (
        event.data.message === MessageName.RecordStarted &&
        startResponseCb
      )
        startResponseCb(event.data as RecordStartedMessage);
      else if (
        event.data.message === MessageName.RecordStopped &&
        stopResponseCb
      ) {
        const data = event.data as RecordStoppedMessage;
        // On firefox, the event.data is immutable, so we need to clone it to avoid errors.
        const newData = {
          ...data,
        };
        newData.events = bufferedEvents.concat(data.events);
        stopResponseCb(newData);
      } else if (event.data.message === MessageName.EmitEvent) {
        startResponseCb(event.data);
        // newEvents.push((event.data as EmitEventMessage).event);

        const e = event.data.event;
        if (e.data.source > 2 && e.data.source < 8) {
          console.log(e.data);
        }
        if (e.data.source === 5) {
          console.log(e.data);
          // capture(e);
          setTimeout(() => {
            capture(e);
          }, 0);
        }
      }
    },
  );

  const localData = (await Browser.storage.local.get()) as LocalData;
  if (
    localData?.[LocalDataKey.recorderStatus]?.status ===
    RecorderStatus.RECORDING
  ) {
    startRecord();
    bufferedEvents = localData[LocalDataKey.bufferedEvents] || [];
  }

  // Before unload pages, cache the new events in the local storage.
  window.addEventListener('beforeunload', (event) => {
    if (!newEvents.length) return;
    event.preventDefault();
    void Browser.storage.local.set({
      [LocalDataKey.bufferedEvents]: bufferedEvents.concat(newEvents),
    });
  });
}

async function initCrossOriginIframe() {
  Browser.storage.local.onChanged.addListener((change) => {
    if (change[LocalDataKey.recorderStatus]) {
      const statusChange = change[
        LocalDataKey.recorderStatus
      ] as Storage.StorageChange;
      const newStatus =
        statusChange.newValue as LocalData[LocalDataKey.recorderStatus];
      if (newStatus.status === RecorderStatus.RECORDING) startRecord();
      else
        window.postMessage(
          { message: MessageName.StopRecord },
          location.origin,
        );
    }
  });
  const localData = (await Browser.storage.local.get()) as LocalData;
  if (
    localData?.[LocalDataKey.recorderStatus]?.status ===
    RecorderStatus.RECORDING
  )
    startRecord();
}

function doRecord() {
  window.postMessage(
    {
      message: MessageName.StartRecord,
      config: {
        recordCrossOriginIframes: true,
      },
    },
    location.origin,
  );
}

function startRecord() {
  const scriptEl = document.createElement('script');
  scriptEl.src = Browser.runtime.getURL('content/inject.js');
  document.documentElement.appendChild(scriptEl);
  scriptEl.onload = () => {
    document.documentElement.removeChild(scriptEl);
  };
}

function generateSession() {
  const newSession: Session = {
    id: nanoid(),
    name: document.title,
    tags: [],
    createTimestamp: Date.now(),
    modifyTimestamp: Date.now(),
    recorderVersion: Browser.runtime.getManifest().version_name || 'unknown',
  };
  return newSession;
}
