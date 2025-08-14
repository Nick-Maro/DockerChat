import { useState } from 'preact/hooks';
import { sendCommandHttp } from '../api/utils';

interface Props {
  privateKey: CryptoKey;
  host: string;
  port: number;
}

export function JoinRoom({ privateKey, host, port }: Props) {
  const [roomName, setRoomName] = useState('');
  const [message, setMessage] = useState('');

  console.log("hei")

  const handleJoin = async () => {
    if (!roomName) {
      setMessage('[CLIENT] Specify room name: j <room_name>');
      return;
    }

    try {
      const response = await sendCommandHttp(
        `join_room:${roomName}`,
        privateKey,
        'client-id', // sostituisci con ID reale
        host,
        port
      );

      if (!response) {
        setMessage('[ERROR] Connection lost, retry or restart client');
      } else {
        setMessage(`Joined room: ${roomName}`);
      }
    } catch (err) {
      console.error(err);
      setMessage('[ERROR] Connection failed');
    }
  };

  return (
    <div>
      <input
        type="text"
        placeholder="Room name"
        value={roomName}
        onInput={(e: any) => setRoomName(e.target.value)}
      />
      <button onClick={handleJoin}>Join Room</button>
      {message && <p>{message}</p>}
    </div>
  );
}