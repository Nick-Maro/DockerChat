import { render } from 'preact';
import { LocationProvider, Router, Route } from 'preact-iso';

import { Header } from './components/Header.js';
import { Home } from './pages/Home/index.js';
import { NotFound } from './pages/_404.js';
import './style.css';

export function App() {
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