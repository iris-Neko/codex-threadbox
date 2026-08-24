export class DoubleClickGate {
  private lastId: string | null = null
  private lastClickAt = 0

  constructor(
    private readonly maximumDelayMs = 650,
    private readonly now: () => number = Date.now
  ) {}

  register(id: string): boolean {
    const clickedAt = this.now()
    const isDoubleClick = this.lastId === id && clickedAt - this.lastClickAt <= this.maximumDelayMs
    this.lastId = isDoubleClick ? null : id
    this.lastClickAt = isDoubleClick ? 0 : clickedAt
    return isDoubleClick
  }
}
