// Keep each person's conversation separate. Unlabelled legacy messages belong
// to the first person, rather than appearing in every chat.
export function actorMessages(session, actorId = session.journey?.activeActorId) {
  const messages = session.messages || []
  if (!actorId) return messages
  const firstId = session.scene?.actors?.[0]?.id
  return messages.filter(message =>
    (message.role === 'user' ? message.recipientId : message.actorId) === actorId ||
    (!(message.role === 'user' ? message.recipientId : message.actorId) && actorId === firstId))
}
