const INTERNAL_PARSER_NAME = /\bmineru(?: document parser)?\b/gi;

export function publicProcessingMessage(message: string) {
  return message.replace(INTERNAL_PARSER_NAME, "Document parser");
}
