import { render } from 'preact';
import { LocationProvider, Router, Route } from 'preact-iso';
import { useWebSocket } from './shared/useWebSocket.js';
import { WS_CONFIG } from './config.js';
import { useEffect } from 'preact/hooks';
import { generatePublicKey } from './shared/utils.js';

import { Home } from './pages/Home/index.js';
import { NotFound } from './pages/_404.js';
import './style.css';


export function App() {
	const { ws, sendMessage } = useWebSocket(`ws://${WS_CONFIG.HOST}:${WS_CONFIG.PORT}`);
	useEffect(() => {
		if(!ws) return;
		
		const registerClient = async () => {
			let clientId = localStorage.getItem('client_id');
			if(!clientId){
				const publicKey = await generatePublicKey();
				sendMessage({ command: 'upload_public_key', client_id: clientId, public_key: publicKey });
			}
		};
		
		registerClient();
	}, [ws]);

	return (
		<LocationProvider>
			<main>
				<Router>
					<Route path="/" component={Home} />
					<Route default component={NotFound} />
				</Router>
			</main>
		</LocationProvider>
	);
}

render(<App />, document.getElementById('app'));