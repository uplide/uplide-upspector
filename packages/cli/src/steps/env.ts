import { applied, skipped, type Step } from "../step.js";

const EXAMPLE = ".env.example";
const VARIABLE = "NEXT_PUBLIC_DEBUGBAR";

/** Documents the switch in the committed env template. */
export const envStep: Step = {
  name: "env",
  run({ files }) {
    const text = files.read(EXAMPLE);
    if (text === undefined) return skipped(`no ${EXAMPLE}`);
    if (new RegExp(`^\\s*${VARIABLE}=`, "m").test(text)) {
      return skipped(`${EXAMPLE} already has ${VARIABLE}`);
    }

    const separator = text === "" || text.endsWith("\n") ? "" : "\n";
    files.write(EXAMPLE, `${text}${separator}${VARIABLE}=false\n`);
    return applied(`added ${VARIABLE} to ${EXAMPLE}`);
  },
};
