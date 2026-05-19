/**
 * Parst einen GEO-URI der Form geo:lat,lng?z=zoom
 * Spec: RFC 5870
 */
export class GeoUri {
  /**
   * @param {string} uri  z.B. "geo:51.56018,6.71694?z=14"
   * @returns {{ lat: number, lng: number, zoom: number }}
   * @throws {Error} wenn das Format nicht erkannt wird
   */
  static parse(uri) {
    const match = uri.match(/^geo:([+-]?\d+(?:\.\d+)?),([+-]?\d+(?:\.\d+)?)(?:\?z=(\d+))?/);
    if (!match) {
      throw new Error(`Ungültiger GEO-URI: ${uri}`);
    }
    return {
      lat: parseFloat(match[1]),
      lng: parseFloat(match[2]),
      zoom: match[3] !== undefined ? parseInt(match[3], 10) : 13,
    };
  }
}
