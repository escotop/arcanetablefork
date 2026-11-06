import { Component, createSignal, Match, Show, Switch } from 'solid-js';
import { toast } from 'solid-sonner';
import UserIcon from 'lucide-solid/icons/user';
import UserCheckIcon from 'lucide-solid/icons/user-check';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import { TextField, TextFieldInput, TextFieldLabel } from '~/components/ui/text-field';
import { displayName, useAuth } from '~/lib/auth';
import { supabase } from '~/lib/supabase';

type AuthMode = 'login' | 'signup';

const USERNAME_RE = /^[A-Za-z0-9_.-]{3,24}$/;

function friendlyAuthError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/invalid login credentials/i.test(message)) return 'Wrong email or password.';
  if (/email not confirmed/i.test(message)) return 'Confirm your email before signing in.';
  if (/already registered/i.test(message)) return 'An account with this email already exists.';
  if (/database error saving new user/i.test(message)) return 'That username is already taken.';
  return message || 'Something went wrong.';
}

const AuthDialog: Component<{
  mode: AuthMode | null;
  onModeChange: (mode: AuthMode | null) => void;
}> = props => {
  const auth = useAuth();
  const [email, setEmail] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [username, setUsername] = createSignal('');
  const [error, setError] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);

  const isSignup = () => props.mode === 'signup';

  function switchMode(mode: AuthMode) {
    setError('');
    props.onModeChange(mode);
  }

  function close() {
    setError('');
    setPassword('');
    props.onModeChange(null);
  }

  async function onSubmit(event: SubmitEvent) {
    event.preventDefault();
    setError('');

    const trimmedEmail = email().trim();
    if (!trimmedEmail || !password()) {
      setError('Enter your email and password.');
      return;
    }

    setSubmitting(true);
    try {
      if (isSignup()) {
        const name = username().trim();
        if (!USERNAME_RE.test(name)) {
          setError('Username must be 3–24 characters: letters, numbers, _ . -');
          return;
        }
        if (password().length < 6) {
          setError('Password must be at least 6 characters.');
          return;
        }
        const { data: available } = (await supabase?.rpc('username_available', { name })) ?? {};
        if (available === false) {
          setError('That username is already taken.');
          return;
        }
        const { needsConfirmation } = await auth.signUp(trimmedEmail, password(), name);
        toast.success(
          needsConfirmation ? 'Account created. Check your email to confirm it.' : 'Account created',
        );
      } else {
        await auth.signIn(trimmedEmail, password());
        toast.success('Signed in');
      }
      close();
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={props.mode !== null} onOpenChange={open => !open && close()}>
      <DialogContent class='max-w-sm'>
        <DialogHeader>
          <DialogTitle>{isSignup() ? 'Create account' : 'Sign in'}</DialogTitle>
          <DialogDescription>
            {isSignup()
              ? 'Create an account to keep your profile across devices.'
              : 'Sign in to your Untapped Table account.'}
          </DialogDescription>
        </DialogHeader>

        <form class='flex flex-col gap-3' onSubmit={onSubmit}>
          <Show when={isSignup()}>
            <TextField value={username()} onChange={setUsername}>
              <TextFieldLabel>Username</TextFieldLabel>
              <TextFieldInput type='text' autocomplete='username' maxLength={24} />
            </TextField>
          </Show>
          <TextField value={email()} onChange={setEmail}>
            <TextFieldLabel>Email</TextFieldLabel>
            <TextFieldInput type='email' autocomplete='email' />
          </TextField>
          <TextField value={password()} onChange={setPassword}>
            <TextFieldLabel>Password</TextFieldLabel>
            <TextFieldInput
              type='password'
              autocomplete={isSignup() ? 'new-password' : 'current-password'}
            />
          </TextField>

          <Show when={error()}>
            <p class='text-sm text-destructive' role='alert'>
              {error()}
            </p>
          </Show>

          <DialogFooter class='mt-2 flex-col gap-2 sm:flex-col'>
            <Button type='submit' disabled={submitting()}>
              {submitting() ? 'Please wait…' : isSignup() ? 'Create account' : 'Sign in'}
            </Button>
            <Button
              type='button'
              variant='link'
              size='sm'
              onClick={() => switchMode(isSignup() ? 'login' : 'signup')}>
              {isSignup() ? 'Already have an account? Sign in' : "Don't have an account? Create one"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export const ProfileMenu: Component = () => {
  const auth = useAuth();
  const [dialogMode, setDialogMode] = createSignal<AuthMode | null>(null);

  async function onSignOut() {
    try {
      await auth.signOut();
      toast.success('Signed out');
    } catch (err) {
      toast.error(friendlyAuthError(err));
    }
  }

  return (
    <Show when={auth.enabled}>
      <DropdownMenu>
        <DropdownMenuTrigger
          as={Button<'button'>}
          variant='outline'
          size='icon'
          class='rounded-full'
          aria-label='Profile'
          disabled={auth.loading()}>
          <Show when={auth.user()} fallback={<UserIcon class='size-4' />}>
            <UserCheckIcon class='size-4' />
          </Show>
        </DropdownMenuTrigger>
        <DropdownMenuContent class='min-w-48'>
          <Switch>
            <Match when={auth.user()}>
              {user => (
                <>
                  <DropdownMenuLabel>
                    <p class='truncate'>{displayName(user())}</p>
                    <p class='truncate text-xs font-normal text-muted-foreground'>{user().email}</p>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => void onSignOut()}>Sign out</DropdownMenuItem>
                </>
              )}
            </Match>
            <Match when={!auth.user()}>
              <DropdownMenuItem onSelect={() => setDialogMode('login')}>Sign in</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDialogMode('signup')}>
                Create account
              </DropdownMenuItem>
            </Match>
          </Switch>
        </DropdownMenuContent>
      </DropdownMenu>

      <AuthDialog mode={dialogMode()} onModeChange={setDialogMode} />
    </Show>
  );
};
