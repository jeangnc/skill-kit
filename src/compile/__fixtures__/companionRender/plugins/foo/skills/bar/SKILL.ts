import { defineSkill } from "#skill-kit";

export default defineSkill({
  name: "bar",
  description: "Fixture skill that exercises the typed companions section.",
  companions: [
    { file: "a.md", summary: "First companion." },
    { file: "b.md", summary: "Second companion." },
  ],
});
