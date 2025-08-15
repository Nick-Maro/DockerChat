import { useEffect, useState } from 'preact/hooks';
import { WS_CONFIG } from "../config";
import type { Room } from "../types";
import { useWebSocket } from '../shared/useWebSocket';

// icons
import styles from '../css/roomsList.module.css';
import addIcon from '../assets/icons/plus-8775e9.svg';



export function RoomList() {
    const [rooms, setRooms] = useState<Room[]>([]);
    const { ws, messages, sendMessage } = useWebSocket(`ws://${WS_CONFIG.HOST}:${WS_CONFIG.PORT}`);

    useEffect(() => {
        const clientId = localStorage.getItem('client_id');
        if (clientId) sendMessage({ command: 'list_rooms', clientId });
    }, [ws]);

    useEffect(() => {
        messages.forEach((data) => {
            if(data.command === 'upload_public_key' && data.status === 'registered'){
                localStorage.setItem('client_id', data.client_id);
                sendMessage({ command: 'list_rooms', client_id: data.client_id });
            }

            if(data.command === 'list_rooms' && data.rooms) setRooms(data.rooms);
        });
    }, [messages]);


    return (
        <div className={`${styles.rooms} flex column`}>
            <h2>Rooms</h2>
            <ul className="center-flex row">
                <li>
                    <button className={`${styles.addRoomBtn} center-flex`}>
                        <img src={addIcon} alt="add" />
                    </button>
                </li>
                {rooms.map((room) => (
                    <li key={room.name}>
                        <img
                            src={`https://placehold.co/50x50/8775E9/FFF?text=${room.name.charAt(0).toUpperCase()}`}
                            alt={room.name}
                            title={`${room.name} — ${room.clients} clients, ${room.messages} messages`}
                        />
                    </li>
                ))}
            </ul>
        </div>
    );
}
