export default function Card({
  user,
  unreadCount,
  messages
}: {
  user: { name: string; id: string; isAdmin: boolean }
  unreadCount: number
  messages: { id: string; text: string }[]
}) {
  return (
    <div className='card'>
      <div className='header'>
        <h1>Welcome, {user.name}</h1>
      </div>
      <div className='body'>
        {user.isAdmin ? <AdminPanel userId={user.id} /> : <p>You have {unreadCount} new messages</p>}
        <ul className='messages'>
          {messages.map((message, i) => (
            <li className='message' key={message.id}>
              {message.text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
