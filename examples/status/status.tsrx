export default function Status({ groups }: { groups: { id: string; title: string; status: string; items: { label: string; value: string }[] }[] }) @{
  <div className="status-list">
    @for (const group of groups; index gi; key group.id) {
      <div className="group">
        <h2>{group.title}</h2>
        @if (group.status === "ok") {
          <Badge tone="green">All good</Badge>
        } @else if (group.status === "warn") {
          <Badge tone="yellow" pulse>Needs attention</Badge>
        } @else {
          <Badge tone="red">Failing</Badge>
        }
        <ul>
          @for (const item of group.items) {
            <li>{item.label}: {item.value}</li>
          }
        </ul>
      </div>
    }
  </div>
}
