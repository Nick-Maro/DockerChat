import { useState } from "react";

export default function Avatar({ username }) {
  const [loaded, setLoaded] = useState(false);

  return (
    <>
      {loaded && ( <img src="/pfp-placeholder.svg" alt="placeholder" /> )}
      <img src={`https://avatar.iran.liara.run/public?username=${username}`} alt="pfp" onLoad={() => setLoaded(true)} width={50} />
    </>
  );
}