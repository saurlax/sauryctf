// Package main is the entry point for SauryCTF backend.
//
// @title           SauryCTF API
// @version         0.1.0
// @description     Next-generation CTF/AWD platform API.
//
// @contact.name   SauryCTF
// @contact.url    https://github.com/saurlax/sauryctf
//
// @license.name  MIT
//
// @host      localhost:8080
// @BasePath  /api
//
// @securityDefinitions.apikey  BearerAuth
// @in                          header
// @name                        Authorization
// @description                 JWT token: "Bearer <token>"
//
//go:generate go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.7.0 --config ../../api/oapi-codegen.yaml ../../api/openapi.yaml
package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/saurlax/sauryctf/internal/config"
	"github.com/saurlax/sauryctf/internal/db"
	httphandler "github.com/saurlax/sauryctf/internal/http"
)

func main() {
	cfg := config.Load()

	database, err := db.Connect()
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to connect to database: %v\n", err)
		os.Exit(1)
	}

	if err := db.Migrate(database); err != nil {
		fmt.Fprintf(os.Stderr, "failed to migrate database: %v\n", err)
		os.Exit(1)
	}

	engine := httphandler.NewServer(database, cfg)

	addr := fmt.Sprintf("%s:%s", cfg.Host, cfg.Port)

	httpServer := &http.Server{
		Addr:         addr,
		Handler:      engine,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	go func() {
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			fmt.Fprintf(os.Stderr, "server error: %v\n", err)
		}
	}()

	go func() {
		ticker := time.NewTicker(cfg.InstanceCleanupInterval)
		defer ticker.Stop()

		for range ticker.C {
			cleaned, err := httphandler.CleanupExpiredChallengeInstances(database, cfg, time.Now())
			if err != nil {
				fmt.Fprintf(os.Stderr, "instance cleanup error: %v\n", err)
				continue
			}
			if cleaned > 0 {
				fmt.Printf("Cleaned up %d expired instance lease(s)\n", cleaned)
			}
		}
	}()

	fmt.Printf("Server starting on %s\n", addr)

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	fmt.Println("Shutdown signal received, gracefully stopping...")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := httpServer.Shutdown(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "shutdown error: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("Server stopped")
}
