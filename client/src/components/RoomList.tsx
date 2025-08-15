import { useEffect, useRef, useState } from 'preact/hooks';
import { WS_CONFIG } from "../config";
import type { Room } from "../types";
import { useWebSocket } from '../shared/useWebSocket';

// icons
import styles from '../css/roomsList.module.css';
import addIcon from '../assets/icons/plus-8775e9.svg';
import { useClientCommands } from '../shared/client';


export function RoomList() {
    const [rooms, setRooms] = useState<Room[]>([]);
    const { messages, sendMessage } = useWebSocket(`ws://${WS_CONFIG.HOST}:${WS_CONFIG.PORT}`);
    const { sendCommand } = useClientCommands(messages, sendMessage);

    useEffect(() => { sendCommand('list_rooms'); }, [sendCommand]);
    useEffect(() => {
        messages.forEach(msg => {
            if(msg.command === 'list_rooms' && msg.rooms) setRooms(msg.rooms);
            if (msg.command?.startsWith('join_room:') && msg.room_name) {
                sendCommand('list_rooms', {}, true);
            }
        });
    }, [messages]);

    const handleAddRoom = () => {
        const name = prompt("Nome della stanza:");
        if (name) {
            sendCommand(`join_room:${name}`, {}, true);
        }
    };


    return (
        <div className={`${styles.rooms} flex column`}>
            <h2>Rooms</h2>
            <ul className="center-flex row">
                <li>
                    <button className={`${styles.addRoomBtn} center-flex`} onClick={handleAddRoom}>
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
