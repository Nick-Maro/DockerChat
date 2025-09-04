import { useState } from "react";
import placeholder from "../assets/icons/pfp-placeholder.svg";

export default function Avatar({ username }) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div style={{ width: 50, height: 50 }}>
      {!loaded && ( <img src={placeholder} alt="placeholder" /> )}
      <img src={`https://avatar.iran.liara.run/public?username=${username}`} onLoad={() => setLoaded(true)} width={50} />
    </div>
  );
}