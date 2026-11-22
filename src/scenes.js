// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`): a journal entry on a NetBox
// device, e.g. "UPS on battery" when Gladys sees the power go out.
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  add_journal_entry(hub, { fields }) {
    return hub.addJournalEntry(fields);
  },
};
