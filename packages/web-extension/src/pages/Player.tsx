import { useRef, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import Replayer from 'rrweb-player';
import { Replayer as ReplayerBase } from 'rrweb';
import html2canvas from 'html2canvas';
import {
  Box,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  Center,
} from '@chakra-ui/react';
import { getEvents, getSession } from '~/utils/storage';
import { documentNode } from '../../../rrweb-snapshot/src/types';

export default function Player() {
  const playerElRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Replayer | null>(null);
  const { sessionId } = useParams();
  const [sessionName, setSessionName] = useState('');

  // var body = $(iframe).contents().find('body')[0];
  // html2canvas(body, {
  //     onrendered: function( canvas ) {
  //         $("#content").empty().append(canvas);
  //     },

  useEffect(() => {
    if (!sessionId) return;
    getSession(sessionId)
      .then((session) => {
        setSessionName(session.name);
      })
      .catch((err) => {
        console.error(err);
      });
    getEvents(sessionId)
      .then((events) => {
        if (!playerElRef.current) return;

        const linkEl = document.createElement('link');
        linkEl.href =
          'https://cdn.jsdelivr.net/npm/rrweb-player@latest/dist/style.css';
        linkEl.rel = 'stylesheet';
        document.head.appendChild(linkEl);
        playerRef.current = new Replayer({
          target: playerElRef.current as HTMLElement,
          props: {
            events,
            autoPlay: true,
          },
        });
        // playerRef.current.addEventListener('mouse-interaction', (payload) => {
        //   console.log(payload);
        // });
        // playerRef.current.console.log(playerRef.current.getReplayer());

        const b = playerElRef.current.querySelector('.rr-player iframe');

        console.log(b, b?.contentWindow?.document.body);
        console.log(b, b?.contentDocument);

        html2canvas(b?.contentDocument?.body, {
          allowTaint: true,
          logging: true,
          debug: true,
          useCORS: true,
        }).then((canvas) => {
          document.body.appendChild(canvas);

          const base64image = canvas.toDataURL('image/png');
          const img = document.createElement('img');
          img.src = base64image;
          document.body.appendChild(img);
        });
      })
      .catch((err) => {
        console.error(err);
      });
    return () => {
      playerRef.current?.pause();
    };
  }, [sessionId]);

  return (
    <>
      <Breadcrumb mb={5} fontSize="md">
        <BreadcrumbItem>
          <BreadcrumbLink href="#">Sessions</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbItem>
          <BreadcrumbLink>{sessionName}</BreadcrumbLink>
        </BreadcrumbItem>
      </Breadcrumb>
      <Center>
        <Box ref={playerElRef}></Box>
      </Center>
    </>
  );
}
