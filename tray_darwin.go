//go:build darwin

package main

import (
	"fmt"
	"os"
	"os/signal"
	"syscall"
)

// macOS has no desktop control window in this project, so only console mode is supported.
func attachConsoleIfCLI() {}

func RunDesktopApp(srv *ServerManager) {
	fmt.Printf("LAN Racer 3D server running at %s. Press Ctrl+C to stop.\n", srv.LocalURL())
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	<-sig
	_ = srv.Stop()
}
