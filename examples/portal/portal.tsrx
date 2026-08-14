import { createPortal } from "octane";
interface ToastBodyProps {
  onDismiss: () => void;
}

interface SavedToastProps extends ToastBodyProps {
  target: HTMLElement;
}

interface PortalProps extends SavedToastProps {
  onBubble: () => void;
}

function SavedToast({ target, onDismiss }: SavedToastProps) {
  return createPortal(ToastBody, target, { onDismiss });
}

function ToastBody({ onDismiss }: ToastBodyProps) @{
	<aside className="toast" aria-label="Save notification">
		<p role="status">Draft saved.</p>
		<button type="button" onClick={onDismiss}>Dismiss</button>
	</aside>
}

export default function Portal({ target, onDismiss, onBubble }: PortalProps) @{
	<section className="editor" onClick={onBubble}>
		<h2>Draft editor</h2>
		<p>Portal clicks still follow their logical Beast parent.</p>
		<SavedToast target={target} onDismiss={onDismiss} />
	</section>
}
