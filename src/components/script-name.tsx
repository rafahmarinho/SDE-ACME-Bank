import { nonLatinScripts } from "@/services/bank";

/** Shows a user-supplied name and flags letters from non-Latin alphabets, which can imitate Latin ones. */
export function ScriptName({ value }: { value: string }) {
  const scripts = nonLatinScripts(value);
  return (
    <>
      {value}
      {scripts.length > 0 && (
        <span
          className="script-notice"
          title="This name uses letters from another alphabet that can look like Latin letters. Check it carefully."
        >
          {scripts.join(", ")} characters
        </span>
      )}
    </>
  );
}
