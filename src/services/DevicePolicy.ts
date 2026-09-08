export class DevicePolicy {
  public constructor(private readonly maxActiveDevices = 1) {}
  public canRegister(activeDevices: number): boolean { return activeDevices < this.maxActiveDevices; }
  public get limit(): number { return this.maxActiveDevices; }
}
