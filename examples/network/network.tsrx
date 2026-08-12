import { useSyncExternalStore } from "octane";
function subscribe(onStoreChange: () => void) {
  window.addEventListener("online", onStoreChange);
  window.addEventListener("offline", onStoreChange);

  return () => {
    window.removeEventListener("online", onStoreChange);
    window.removeEventListener("offline", onStoreChange);
  };
}

function getSnapshot() {
  return navigator.onLine;
}

function getServerSnapshot() {
  return true;
}

export default function Network() @{
	const isOnline = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

	<p className="network-status" role="status" aria-live="polite">{isOnline ? "Online" : "Offline — changes will sync when you reconnect."}</p>
}
