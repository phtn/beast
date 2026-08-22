"use strong";
import { useLinkedState } from "octane";

export default function Editor({
	user,
	onSave,
}: {
	user: { id: string; name: string };
	onSave: (name: string) => void;
}) @{
	const [name, setName] = useLinkedState(user.id, () => user.name);

	<form className="profile-editor" onSubmit={(event) => { event.preventDefault(); onSave(name); }}>
		<label htmlFor="profile-name">Name</label>
		<input id="profile-name" name="name" value={name} onInput={(event) => setName(event.currentTarget.value)} />
		<p className="preview">Preview: {name.trim().length === 0 ? "Anonymous" : name}</p>
		<button type="submit" disabled={name.trim().length === 0}>Save profile</button>
	</form>
}
