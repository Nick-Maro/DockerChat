// icons
import styles from '../css/roomsList.module.css';
import addIcon from '../assets/icons/plus-8775e9.svg';
import { useChat } from '../shared/chatContext';


export function RoomList(){
    const { rooms } = useChat();

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