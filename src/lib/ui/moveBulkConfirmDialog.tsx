import { Component } from 'solid-js';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog';
import { Button } from '~/components/ui/button';
import {
  cancelPendingBulkMove,
  confirmPendingBulkMove,
  pendingBulkMove,
} from './moveBulkConfirm';

export const MoveBulkConfirmDialogHost: Component = () => {
  return (
    <AlertDialog
      open={!!pendingBulkMove()}
      onOpenChange={open => {
        if (!open) cancelPendingBulkMove();
      }}>
      <AlertDialogContent>
        <AlertDialogTitle>Are you sure?</AlertDialogTitle>
        <AlertDialogDescription>
          Move all {pendingBulkMove()?.cardCount ?? 0} card
          {(pendingBulkMove()?.cardCount ?? 0) === 1 ? '' : 's'} to{' '}
          {pendingBulkMove()?.destination ?? ''}?
        </AlertDialogDescription>
        <div class='mt-4 flex justify-end gap-2'>
          <Button type='button' variant='outline' onClick={cancelPendingBulkMove}>
            Cancel
          </Button>
          <Button type='button' onClick={confirmPendingBulkMove}>
            Move
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default MoveBulkConfirmDialogHost;
