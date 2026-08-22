import { requestFormReset, useActionState, useFormStatus, useOptimistic, useRef } from "octane";
interface EditNameProps {
  names: readonly string[];
  saveName: (name: string) => Promise<void>;
}

function SubmitButton() @{
	const { pending, data, method } = useFormStatus();
	const pendingName = String(data?.get("name") ?? "");

	<button type="submit" disabled={pending} data-method={method}>{pending ? "Saving " + pendingName + "…" : "Save name"}</button>
}

export default function Actions({ names, saveName }: EditNameProps) @{
	const formRef = useRef<HTMLFormElement | null>(null);
	const [optimisticNames, addOptimisticName] = useOptimistic(
	  names,
	  (current, name: string) => [...current, name],
	);
	const [message, submit, isPending] = useActionState(
	  async (_previousMessage: string, formData: FormData) => {
	    const name = String(formData.get("name") ?? "").trim();
	    if (!name) return "Enter a name before saving.";
	    addOptimisticName(name);
	    await saveName(name);
	    if (formRef.current !== null) requestFormReset(formRef.current);
	    return "Saved " + name + ".";
	  },
	  "Save a name.",
	);

	<section className="team-editor">
		<h2>Team members</h2>
		<ul aria-label="Team members">
			@for (const name of optimisticNames; key name) {
				<li>{name}</li>
			}
		</ul>
		<form ref={formRef} action={submit}>
			<label>
				Name
				<input name="name" defaultValue="Ada" />
			</label>
			<SubmitButton />
		</form>
		<p role="status" aria-live="polite" aria-busy={isPending}>{message}</p>
	</section>
}
