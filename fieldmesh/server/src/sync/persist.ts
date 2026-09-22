// Hook into Hocuspocus:
//   onLoadDocument  -> load snapshot + apply newer updates
//   onChange        -> append update, extract edits, flag disputes
//   onStoreDocument -> compacted snapshot (debounced)
export {};
