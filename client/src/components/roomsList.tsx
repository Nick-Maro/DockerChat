import { useEffect, useState } from "preact/hooks";
import { generateOrLoadKeys, signMessage, sendCommandHttp } from "../api/utils";

const HOST = "localhost";
const PORT = 5001;

interface Room {
  id: string;
  name: string;
}

export default function ListRooms() {
  const [keys, setKeys] = useState<{ privateKey: CryptoKey; publicKey: CryptoKey } | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);

  useEffect(() => { generateOrLoadKeys().then(setKeys); }, []);
  useEffect(() => { if (keys) loadRooms(); }, [keys]);

  async function loadRooms(){
    if(!keys) return;

    const response = await sendCommandHttp(
      "list_rooms",
      keys.privateKey,
      "my-client-id",
      HOST,
      PORT
    );

    if(response && response.rooms) setRooms(response.rooms);
    else console.error("[ERROR] Failed to load rooms:", response);
  }

  async function openRoom(roomId: string){
    if (!keys) return;

    const message = `Hello room ${roomId}`;
    const response = await sendCommandHttp(
      `send_message:${message}`,
      keys.privateKey,
      "my-client-id",
      HOST,
      PORT,
      { room_id: roomId }
    );
    console.log("Command response:", response);
  }
  

  return (
    <ul class="flex column">
      {/* {rooms.map(room => (
        <li key={room.id} onClick={() => openRoom(room.id)}>
          <img src={`https://placehold.co/50x50/845B92/FFF?text=${room.name.slice(0,1)}`} alt="pfp" />
          <h3>{room.name}</h3>
        </li>
      ))} */}
    </ul>
  );
}