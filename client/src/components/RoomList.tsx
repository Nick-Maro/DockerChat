// icons
import styles from '../css/roomsList.module.css';
import addIcon from '../assets/icons/plus-8775e9.svg';
import { useChat } from '../shared/chatContext';


export function RoomList(){
    const { rooms, currentRoom, joinRoom, createRoom, leaveRoom } = useChat();

    const handleCreateRoom = () => {
        let roomName = prompt("Enter Room Name: ");
        if(roomName) createRoom(roomName);
    };

    const handleJoinRoom = (roomName: string) => {
        if(currentRoom?.name === roomName) leaveRoom();
        else joinRoom(roomName);
    };

    return (
        <div className={`${styles.rooms} flex column`}>
            <h2>Rooms</h2>
            <ul className="center-flex row">
                <li>
                    <button className={`${styles.addRoomBtn} center-flex`} onClick={() => handleCreateRoom()}>
                        <img src={addIcon} alt="add" />
                    </button>
                </li>
                {rooms.map((room, index) => (
                    <li key={`${room.name}-${index}`} className={currentRoom?.name === room.name ? styles.activeRoom : ''}>
                        <img
                            onClick={() => handleJoinRoom(room.name)}
                            title={`${room.name} — ${room.clients} clients, ${room.messages} messages`}
                            src={`https://placehold.co/50x50/${currentRoom?.name === room.name ? '78C841' : '8775E9'}/FFF?text=${room.name.charAt(0).toUpperCase()}`}
                            alt={room.name}
                        />
                    </li>
                ))}
            </ul>
        </div>
    );
}