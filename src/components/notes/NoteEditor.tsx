import { useEditor, EditorContent, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Toggle } from "@/components/ui/toggle";
import { Bold, Italic, Heading2, Heading3, List, ListOrdered } from "lucide-react";

interface NoteEditorProps {
  content: JSONContent | null;
  onChange: (content: JSONContent) => void;
}

export default function NoteEditor({ content, onChange }: NoteEditorProps) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: content && Object.keys(content).length > 0 ? content : "",
    editorProps: {
      attributes: {
        class:
          "prose prose-sm dark:prose-invert max-w-none min-h-[200px] rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none",
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getJSON()),
  });

  if (!editor) return null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1 rounded-md border border-input bg-muted/30 p-1">
        <Toggle
          size="sm"
          pressed={editor.isActive("bold")}
          onPressedChange={() => editor.chain().focus().toggleBold().run()}
          aria-label="Negrito"
        >
          <Bold className="h-4 w-4" />
        </Toggle>
        <Toggle
          size="sm"
          pressed={editor.isActive("italic")}
          onPressedChange={() => editor.chain().focus().toggleItalic().run()}
          aria-label="Itálico"
        >
          <Italic className="h-4 w-4" />
        </Toggle>
        <Toggle
          size="sm"
          pressed={editor.isActive("heading", { level: 2 })}
          onPressedChange={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          aria-label="Título grande"
        >
          <Heading2 className="h-4 w-4" />
        </Toggle>
        <Toggle
          size="sm"
          pressed={editor.isActive("heading", { level: 3 })}
          onPressedChange={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          aria-label="Título pequeno"
        >
          <Heading3 className="h-4 w-4" />
        </Toggle>
        <Toggle
          size="sm"
          pressed={editor.isActive("bulletList")}
          onPressedChange={() => editor.chain().focus().toggleBulletList().run()}
          aria-label="Lista"
        >
          <List className="h-4 w-4" />
        </Toggle>
        <Toggle
          size="sm"
          pressed={editor.isActive("orderedList")}
          onPressedChange={() => editor.chain().focus().toggleOrderedList().run()}
          aria-label="Lista numerada"
        >
          <ListOrdered className="h-4 w-4" />
        </Toggle>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
