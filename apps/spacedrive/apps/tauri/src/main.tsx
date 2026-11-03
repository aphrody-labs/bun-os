import { ErrorBoundary, MotionPreferences } from '@sd/interface';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
	<React.StrictMode>
		<ErrorBoundary>
			<MotionPreferences>
				<App />
			</MotionPreferences>
		</ErrorBoundary>
	</React.StrictMode>
);
