import { DialogTrigger, DialogContent, DialogHeader, DialogDescription, DialogFooter, Dialog } from "~/components/ui/dialog";
import { MenubarItem } from "~/components/ui/menubar";
import { setSettings, settings } from "../globals";
import { Label } from "~/components/ui/label";
import { Checkbox } from "~/components/ui/checkbox";
import { Button } from "~/components/ui/button";

export default function SettingsOverlay(props: { isOpen: boolean;  onClose():void, onOpen():void}) {
  return (
    <Dialog
      open={props.isOpen}
      onOpenChange={isOpen => isOpen ? props.onOpen() : props.onClose()}>
      <DialogTrigger as={MenubarItem} class='w-full'>
        Settings
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>Settings</DialogHeader>
        <DialogDescription>
          <Label class='flex items-baseline space-x-2'>
            <Checkbox
              id='camera-tilt'
              checked={settings.enableCameraTilt}
              onChange={checked => setSettings('enableCameraTilt', checked)}
            />
            <span>Enable Camera Tilt </span>
          </Label>
        </DialogDescription>
        <DialogFooter>
          <Button onClick={props.onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
