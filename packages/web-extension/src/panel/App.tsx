import { MessageName } from '~/types';
import Channel from '~/utils/channel';

const channel = new Channel();

export default function App() {
  window.addEventListener(
    'message',
    (
      event: MessageEvent<{
        message: MessageName;
      }>,
    ) => {
      console.log('content message', event.data);
    },
  );

  return <>123</>;
}
