export default function Card({ user, unreadCount, messages }: { user: { name: string; id: string; isAdmin: boolean }; unreadCount: number; messages: { id: string; text: string }[] }) @{
  <div className="card">
    <div className="header">
      <h1>Welcome, {user.name}</h1>
    </div>
    <div className="body">
      @if (user.isAdmin) {
        <AdminPanel userId={user.id} />
      } @else {
        <p>You have {unreadCount} new messages</p>
      }
      <ul className="messages">
        @for (const message of messages; index i; key message.id) {
          <li className="message">{message.text}</li>
        }
      </ul>
    </div>
  </div>
}
