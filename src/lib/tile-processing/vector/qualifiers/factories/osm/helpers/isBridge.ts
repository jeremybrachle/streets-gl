// An OSM way is a bridge when it carries a bridge=* tag with any value other than "no". OSM applies
// the tag to the whole way (there is no per-node bridging), so this is a whole-way classification.
// See https://wiki.openstreetmap.org/wiki/Key:bridge
export default function isBridge(tags: Record<string, string>): boolean {
	return tags.bridge !== undefined && tags.bridge !== 'no';
}
